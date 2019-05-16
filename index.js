'use strict';

const path = require('path');
const isString = require('lodash.isstring');
const isObject = require('lodash.isobject');
const Vinyl = require('vinyl');
const Stream = require('stream');



function _getOptions(options, stream) {
	return _parseOptions(isString(options) ?
		_getStringOptions(options, stream) :
		(isObject(options) ?
			Promise.resolve(options) :
			Promise.reject(new Error("options must be an object or a string!"))
		)
	);
}

async function _getStringOptions(optionsPath, stream) {
	try {
		const input = path.resolve(optionsPath);

		const bundle = await require('rollup').rollup({
			input: input,
			onwarn: warning=> {
				if (warning.code !== 'UNRESOLVED_IMPORT') console.warn(warning.message);
			}
		});
		const result = await bundle.generate({format: 'cjs'});

		// don't look at me. this is how Rollup does it.
		const defaultLoader = require.extensions['.js'];

		require.extensions['.js'] = function(module, filename) {
			if (filename === input) {
				module._compile(result.code, filename);
			} else {
				defaultLoader(module, filename);
			}
		};

		try {
			return require(input);
		} finally {
			require.extensions['.js'] = defaultLoader;
		}
	} catch (err) {
		setImmediate(()=>stream.emit('error', err));
	}

	return {};
}

async function _parseOptions(options, stream) {
	try {
		const _options = await options;
		const rollup = _options.rollup || require('rollup');
		const hasCustomRollup = !!_options.rollup;

		const parsedOptions = {};
		for (let key in _options) {
			if (key === 'sourceMap' && !hasCustomRollup) {
				console.warn(`The sourceMap option has been renamed to \"sourcemap\" (lowercase \"m\") in Rollup. The old form is now deprecated in rollup-stream.`);
				parsedOptions.sourcemap = _options.sourceMap;
			} else if (key !== 'rollup') {
				parsedOptions[key] = _options[key];
			}
		}

		return {options:parsedOptions, rollup};
	} catch (err) {
		setImmediate(()=>stream.emit('error', err));
	}

	return {};
}

function makeArray(ary) {
	if (Array.isArray(ary)) return ary;
	if ((ary === null) || (ary === undefined)) return [];
	return [ary];
}

async function go({options, rollup}, stream) {
	try {
		const bundle = await rollup.rollup({
			...options.input,
			plugins: [
				...makeArray(options.input.plugins),
				{options: input=>{
					const onwarn = input.onwarn;
					options.input = input;
					input.onwarn = (warning, warn)=>{
						stream.emit('warn', warning);
						if (!!onwarn) onwarn(warning, warn);
					};
					return null;
				}}
			]
		});

		stream.emit('bundle', bundle);
		const results = await bundle.generate(options.output);
		(results.output || results || []).forEach(results=>{
			const {code, map} = results;

			const vinyl = new Vinyl({
				contents: Buffer.from(code),
				sourceMap: map,
				path: options.input.input,
				cwd: process.cwd()
			});

			stream.write(vinyl);
		});
		stream.push(null);
	} catch(err) {
		console.log("ERROR",options.input.input);
		setImmediate(()=>stream.emit('error', err));
	}
}

function rollupStream(options) {
	const stream = new Stream.PassThrough({objectMode:true});

	_getOptions(options, stream)
		.then(
			options=>go(options, stream),
			err=>setImmediate(()=>stream.emit('error', err))
		);

	return stream;
}

module.exports = rollupStream;
