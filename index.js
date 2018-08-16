const { log, finalizeArgs, execSteps } = require('jsuti');
const fs = require('fs-extra');
const del = require('del');
const { Resolver, NpmHttpRegistry } = require('./core/turbo-resolver');
const fetch = require('isomorphic-fetch');
const path = require('path');

// configs
/**
 * final args object
 */
const cliArgs = {};
/**
 * possible args
 */
const possibleArgs = [
  // install
  {
    name: 'install',
    arg: 'install',
    abbr: 'i',
    default: undefined
  }
];
/**
 * Steps name constants
 */
const STEPS = {
  PREPARE: 'Prepare',
  INSTALL: 'Install'
};
/**
 * eject steps
 */
const runSteps = [
  // prepare
  {
    name: STEPS.PREPARE,
    exec: (args, step) => {
      finalizeArgs(args, possibleArgs);
    }
  },
  // install
  {
    name: STEPS.INSTALL,
    childProcesses: [STEPS.PREPARE],
    exec: (args, step) => {},
    undo: (args, step) => {}
  }
];

let [, , action] = process.argv;
if (!action) {
  action = 'install';
} else if (!STEPS[action.toUpperCase()]) {
  const actionArg = possibleArgs.find(
    ({ arg, abbr }) => action === arg || action === abbr
  );
  if (!actionArg) {
    throw new Error(`Action "${action}" is invalid!`);
    process.exit(1);
  }
  action = actionArg.name;
}

action = STEPS[action.toUpperCase()];
const step = runSteps.find(({ name }) => name === action);

const resolve = dependencies => {
  // const resolver = new Resolver(); // For server-side usage, uses https://registry.npmjs.org which doesn't have CORS enabled

  const resolver = new Resolver({
    registry: new NpmHttpRegistry({
      registryUrl: 'https://registry.npmjs.org/'
    })
  });

  return resolver.resolve(dependencies);
};
const project = {
  vendorFiles: {},
  dirCache: {}
};
const createdPaths = {};
resolve({
  rxjs: '~5.5.0'
})
  .then(({ appDependencies, resDependencies }) => {
    return Promise.all(
      Object.keys(appDependencies).map(pkg => {
        const { version, dependencies, main } = appDependencies[pkg];
        return fetch(`https://t.staticblitz.com/v4/${pkg}@${version}`)
          .then(res => res.json())
          .then(({ dirCache, vendorFiles }) => {
            project.dirCache[`${pkg}@${version}`] =
              dirCache[`${pkg}@${version}`];
            return Promise.all(
              Object.keys(vendorFiles).map(file => {
                const url = `https://unpkg.com${file}`;
                project.vendorFiles[url] = {
                  fullPath: url,
                  content: vendorFiles[file]
                };
                const folder = path.dirname(file).replace(`@${version}`, '');
                const fileFolder = path.join(
                  process.cwd(),
                  'node_modules',
                  folder
                );
                if (!createdPaths[folder]) {
                  createdPaths[folder] = fs.ensureDir(fileFolder);
                }
                return createdPaths[folder].then(() => {
                  // TODO: write file content
                  // fs.writeFileSync(path.join(fileFolder, ));
                });
              })
            );
          });
      })
    );
  })
  .then(project => {
    console.log(project);
  });
