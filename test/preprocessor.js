const tsc = require('typescript');
const tsConfig = require('../tsconfig.json');

module.exports = {
  process(src, path) {
    // jest >= 28 requires transformers to return an object with a `code` string
    // (previously a bare string was accepted). See:
    // https://jestjs.io/docs/upgrading-to-jest28#transformer
    if (path.endsWith('.ts')) {
      return { code: tsc.transpile(src, tsConfig.compilerOptions, path, []) };
    }
    return { code: src };
  },
};
