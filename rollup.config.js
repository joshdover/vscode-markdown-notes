// rollup.config.js
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/extension.ts',
  output: {
    dir: 'out',
    format: 'cjs'
  },
  plugins: [typescript()]
};
