import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { parse } from 'acorn';

const require = createRequire(import.meta.url);

// ndarray generates typed-array views with Function(). Compile those views at
// build time so the browser can keep its policy against JavaScript evaluation.
async function precompileImageArrays(bundle){
  const ndarrayPath = require.resolve('ndarray');
  const source = await readFile(ndarrayPath, 'utf8');
  const module = { exports:{} };
  let factoryCode = '';
  function captureFactory(...parts){
    const factory = Function(...parts);
    factoryCode = factory.toString();
    return factory;
  }
  runInNewContext(`${source}\nmodule.exports.compileConstructor = compileConstructor; module.exports.types = Object.keys(CACHED_CONSTRUCTORS);`, {
    module,
    require:createRequire(ndarrayPath),
    Function:captureFactory
  });
  const factories = [];
  for (const dtype of module.exports.types){
    const dimensions = [];
    for (let dimension = -1; dimension <= 4; dimension++){
      module.exports.compileConstructor(dtype, dimension);
      dimensions.push(factoryCode);
    }
    factories.push(`${JSON.stringify(dtype)}:[${dimensions.join(',')}]`);
  }
  const replacement = `const PRECOMPILED_IMAGE_VIEWS = {${factories.join(',')}};
function compileConstructor(dtype, dimension){
  const factory = PRECOMPILED_IMAGE_VIEWS[dtype]?.[dimension + 1];
  if (!factory) throw new Error('Unsupported image tensor dimensions');
  if (dimension === 0) return factory(CACHED_CONSTRUCTORS[dtype][0]);
  return factory(CACHED_CONSTRUCTORS[dtype], order);
}`;
  const tree = parse(bundle, { ecmaVersion:'latest', sourceType:'module' });
  let constructor;
  function visit(node){
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'compileConstructor') constructor = node;
    for (const value of Object.values(node)){
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
  if (!constructor) throw new Error('Image-array constructor not found in pinned library');
  return bundle.slice(0, constructor.start) + replacement + bundle.slice(constructor.end);
}

await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/photo-background-removal.js'],
  outfile: 'public/photo-background-removal.js',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome100', 'safari16'],
  plugins:[{
    name:'precompile-image-arrays',
    setup(builder){
      builder.onLoad({ filter:/background-removal[\\/]dist[\\/]index\.mjs$/ }, async args => ({
        contents:await precompileImageArrays(await readFile(args.path, 'utf8')),
        loader:'js',
        resolveDir:fileURLToPath(new URL('../node_modules/@imgly/background-removal/dist/', import.meta.url))
      }));
    }
  }],
  logLevel: 'info'
});
await copyFile(new URL('../public/mapa-recursos-humanos.html', import.meta.url), new URL('../public/mapa-coordenacao-2026.html', import.meta.url));
await build({
  absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),
  entryPoints:['src/rh-sync.mjs'],
  outfile:'public/rh-sync.js',
  bundle:true, minify:true, format:'iife', globalName:'RhSync', platform:'browser', target:['chrome100','safari16']
});
await build({
  absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),
  entryPoints:['src/rh-movements.mjs'], outfile:'public/rh-movements.js',
  bundle:true, minify:true, format:'iife', globalName:'RhMovements', platform:'browser', target:['chrome100','safari16']
});
