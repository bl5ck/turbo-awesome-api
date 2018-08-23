const { log } = require('jsuti');
const spawn = require('cross-spawn');
const fork = (fn, dependencies, ...args) =>
  new Promise(done => {
    const jsutiDependency = dependencies.find(({ path }) => path === 'jsuti');
    let jsutiImport = "const { log } = require('jsuti');";
    if (jsutiDependency) {
      jsutiImport = '';
      if (
        jsutiDependency.extract
          .replace(/[\t \{\}}]/g, '')
          .split(',')
          .indexOf('log') === -1
      ) {
        jsutiDependency.extract = jsutiDependency.extract.replace(
          '}',
          ', log }'
        );
      }
    }
    const scriptContent = `
      ${jsutiImport}
      ${dependencies
        .map(({ extract, path }) => `const ${extract} = require('${path}');`)
        .join('\n')}
      const fn = ${fn.toString()};
      const broadcast = msg => console.log(\`[TO_PARENT]>>>\${JSON.stringify(msg)}\`);
      const res = fn.apply(null, ${JSON.stringify(args)});
      if (res.then) {
        res.then(broadcast);
      }
    `;
    const child = spawn('node', ['-e', scriptContent]);
    child.stderr.on('data', err => {
      log(`<red [Forked process]${err}/>`).write();
    });
    child.stdout.on('data', msg => {
      const message = msg.toString();
      log(
        `<grey \n${message
          .replace(/^\[TO_PARENT\]>>>(.*)$/gm, match => {
            done(JSON.parse(match.replace('[TO_PARENT]>>>', '')));
            return '';
          })
          .replace(/^/gm, '[Forked process] ')} />`
      ).write();
    });
  });
module.exports = fork;
