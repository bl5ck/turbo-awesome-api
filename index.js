const { log, finalizeArgs, execStep } = require('jsuti');
const fs = require('fs-extra');
const del = require('del');
const { Resolver, NpmHttpRegistry } = require('./core/turbo-resolver');
const fetch = require('isomorphic-fetch');
const path = require('path');
const spawn = require('cross-spawn');
const prettyMs = require('pretty-ms');
const startTime = new Date().getTime();
const split = (array, chunk = 4) => {
  let i, j, temparray;
  const result = [];
  for (i = 0, j = array.length; i < j; i += chunk) {
    temparray = array.slice(i, i + chunk);
    result.push(temparray);
  }
};
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
  },
  // development mode
  {
    name: 'dev',
    arg: '--dev',
    abbr: '-d',
    default: false
  }
];
/**
 * Steps name constants
 */
const STEPS = {
  PREPARE: 'Prepare',
  INSTALL: 'Install'
};
const PATHS = (() => {
  const DIR = process.cwd();
  const PACKAGE = path.join(DIR, 'package.json');
  const PACKAGE_BACKUP = `${PACKAGE}.bk`;
  return {
    DIR,
    PACKAGE,
    PACKAGE_BACKUP
  };
})();
/**
 * run steps
 */
const runSteps = [
  // prepare
  {
    name: STEPS.PREPARE,
    exec: (args, step) => {
      finalizeArgs(args, possibleArgs);
      args.dev = args.dev && args.dev !== 'false';
    }
  },
  // install
  {
    name: STEPS.INSTALL,
    childProcesses: [STEPS.PREPARE],
    exec: async (args, step) => {
      let packageJson;
      try {
        packageJson = require(PATHS.PACKAGE);
      } catch (e) {
        throw new Error('Executing directory must have a package.json file.');
      }

      let dependencies = {
        ...packageJson.dependencies,
        ...(packageJson.peerDependencies || {})
      };

      const resolver = new Resolver({
        registry: new NpmHttpRegistry({
          registryUrl: 'https://registry.npmjs.org/'
        }),
        timeout: 30000
      });
      const { appDependencies, resDependencies } = await resolver.resolve(
        dependencies
      );
      await Promise.all(
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
      if (args.dev) {
        await fs.move(PATHS.PACKAGE, PATHS.PACKAGE_BACKUP);
        const { dependencies, peerDependencies, ...res } = packageJson;
        fs.writeFileSync(PATHS.PACKAGE, JSON.stringify(res));
        spawn.sync('yarn', {
          cwd: PATHS.DIR,
          stdio: 'inherit'
        });
        fs.unlinkSync(PATHS.PACKAGE);
        await fs.move(PATHS.PACKAGE_BACKUP, PATHS.PACKAGE);
      }
      const doneTime = new Date().getTime() - startTime;
      log(`<green Done in ${prettyMs(doneTime)}/>`).write();
    },
    undo: async (args, step) => {
      if (args.dev) {
        fs.unlinkSync(PATHS.PACKAGE);
        await fs.move(PATHS.PACKAGE_BACKUP, PATHS.PACKAGE);
      }
    }
  }
];

let [, , action, ...res] = process.argv;
if (!action || (action.startsWith('-') && !res[1])) {
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
const project = {
  vendorFiles: {},
  dirCache: {}
};
const createdPaths = {};

execStep(cliArgs, step, runSteps.indexOf(step), runSteps);
