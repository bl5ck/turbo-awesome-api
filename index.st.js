// @flow
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
  },
  // silent mode
  {
    name: 'silent',
    arg: '--silent',
    abbr: '-s',
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
      const resolveAppDependencies = async pkg => {
        const { version, dependencies, main } = appDependencies[pkg];
        log(`<grey Fetching ${pkg}@${version}... />`).write();
        const res = await fetch(
          `https://t.staticblitz.com/v4/${pkg}@${version}`
        );
        const { dirCache, vendorFiles } = await res.json();
        const fullPkgName = `${pkg}@${version}`;
        project.dirCache[fullPkgName] = dirCache[fullPkgName];
        const writeVendorFiles = async file => {
          const url = `https://unpkg.com${file}`;
          const content = vendorFiles[file];
          project.vendorFiles[url] = {
            fullPath: url,
            content
          };
          const dirName = path.dirname(file);
          const folder = dirName.replace(fullPkgName, pkg);
          const fileFolder = path.join(PATHS.DIR, 'node_modules', folder);
          if (!createdPaths[folder]) {
            createdPaths[folder] = fs.ensureDir(fileFolder);
          }
          await createdPaths[folder];
          const filePath = path.join(fileFolder, file.replace(dirName, ''));
          log(`<grey Writting ${filePath}... />`).write();
          await fs.writeFile(filePath, content);
          return filePath;
        };
        return Promise.all(Object.keys(vendorFiles).map(writeVendorFiles));
      };
      await Promise.all(
        Object.keys(appDependencies).map(resolveAppDependencies)
      );
      if (args.dev) {
        await fs.move(PATHS.PACKAGE, PATHS.PACKAGE_BACKUP);
        const { dependencies, peerDependencies, ...res } = packageJson;
        await fs.writeFile(PATHS.PACKAGE, JSON.stringify(res));
        spawn.sync('yarn', {
          cwd: PATHS.DIR,
          stdio: 'inherit'
        });
        await fs.unlink(PATHS.PACKAGE);
        await fs.move(PATHS.PACKAGE_BACKUP, PATHS.PACKAGE);
      }
      const doneTime = new Date().getTime() - startTime;
      log(`<green Done in ${prettyMs(doneTime)}/>`).write();
    },
    retry: async (error, args, step) => {
      if (
        !error ||
        !error.error ||
        error.error !== 'MISSING_PEERS' ||
        !error.data
      ) {
        return false;
      }
      const stdin = process.openStdin();
      log(
        '<yellow The package.json file is missing bellow peer dependencies:/>'
      );
      const missedDependencies = {};
      Object.keys(error.data).forEach(package => {
        const versionInfo = error.data[package];
        const required = Object.keys(versionInfo)[0];
        log(
          `<white "${required}" requires ${package}@${
            versionInfo[required]
          } to run./>`
        );
        missedDependencies[package] = versionInfo[required];
      });
      log(
        "<green Don't worry, we will add them to dependencies automatically for you./>"
      );
      log('<green Do you want to continue?(Y/N) Default is "Y" />').write();
      let answer;
      if (!args.silent) {
        const stdin = process.openStdin();
        answer = await new Promise(done => {
          stdin.addListener('data', answer => {
            done(
              answer
                .toString()
                .trim()
                .toLowerCase()
            );
          });
        });
        stdin.pause();
      } else {
        answer = 'y';
      }
      switch (answer) {
        case 'y':
        default: {
          // fix peerDependencies
          const { peerDependencies, ...res } = require(PATHS.PACKAGE);
          await fs.move(PATHS.PACKAGE, PATHS.PACKAGE_BACKUP);
          await fs.writeFile(
            PATHS.PACKAGE,
            JSON.stringify(
              {
                ...res,
                peerDependencies: {
                  ...(peerDependencies || {}),
                  ...missedDependencies
                }
              },
              null,
              2
            )
          );
          // clear import cache of package.json
          delete require.cache[require.resolve(PATHS.PACKAGE)];
          // retry
          await step.exec(args, step);
          // remove backup file
          await fs.unlink(PATHS.PACKAGE_BACKUP);
          return true;
        }
        case 'n': {
          log('<grey You chose to do it manually./>').write();
          return false;
        }
      }
    },
    undo: async (args, step) => {
      if (args.dev) {
        await fs.unlink(PATHS.PACKAGE);
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
