const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    webpack: {
        configure: {
            target: 'electron-renderer'
        },
        plugins: [
            new CopyPlugin({
                patterns: [
                    { from: 'node_modules/sql.js/dist/sql-wasm.js', to: 'static/js/' },
                ]
            })
        ],
        module: {
            noParse: /sql-wasm\.js/,
        },
    }
};