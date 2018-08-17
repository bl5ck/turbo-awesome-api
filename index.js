const { log, finalizeArgs, execSteps } = require('jsuti');
const fs = require('fs-extra');
const del = require('del');
const { Resolver, NpmHttpRegistry } = require('./core/turbo-resolver');
const fetch = require('isomorphic-fetch');
const path = require('path');
const { spawn } = require('child_process');
const prettyMs = require('pretty-ms');
const startTime = new Date().getTime();
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
const PATHS = {
  DIR: process.cwd()
};
/**
 * run steps
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
let packageJson;
try {
  packageJson = require(path.join(PATHS.DIR, 'package.json'));
} catch (e) {
  throw new Error('Executing directory must have a package.json file.');
}
resolve(packageJson.dependencies)
  .then(
    ({ appDependencies, resDependencies }) => {
      return Promise.all(
        Object.keys(appDependencies).map(pkg => {
          const { version, dependencies, main } = appDependencies[pkg];
          log(`<grey Fetching ${pkg}@${version}... />`).write();
          return fetch(`https://t.staticblitz.com/v4/${pkg}@${version}`)
            .then(res => res.json())
            .then(({ dirCache, vendorFiles }) => {
              const fullPkgName = `${pkg}@${version}`;
              project.dirCache[fullPkgName] = dirCache[fullPkgName];
              return Promise.all(
                Object.keys(vendorFiles).map(file => {
                  const url = `https://unpkg.com${file}`;
                  const content = vendorFiles[file];
                  project.vendorFiles[url] = {
                    fullPath: url,
                    content
                  };
                  const dirName = path.dirname(file);
                  const folder = dirName.replace(fullPkgName, pkg);
                  const fileFolder = path.join(
                    PATHS.DIR,
                    'node_modules',
                    folder
                  );
                  if (!createdPaths[folder]) {
                    createdPaths[folder] = fs.ensureDir(fileFolder);
                  }
                  return createdPaths[folder].then(() => {
                    const filePath = path.join(
                      fileFolder,
                      file.replace(dirName, '')
                    );
                    log(`<grey Writting ${filePath}... />`).write();
                    fs.writeFileSync(filePath, content);
                    return filePath;
                  });
                })
              );
            });
        })
      );
    },
    err => {
      log(`<red ${JSON.stringify(err, null, 2)} />`).write();
    }
  )
  .then(files => {
    // console.log(files);
    const doneTime = new Date().getTime() - startTime;
    log(`<green Done in ${prettyMs(doneTime)}/>`).write();
  });
