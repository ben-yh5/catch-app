const { withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

module.exports = function withModularHeaders(config) {
    return withDangerousMod(config, [
        'ios',
        async (cfg) => {
            const podfilePath = path.join(
                cfg.modRequest.platformProjectRoot,
                'Podfile'
            )
            let podfile = fs.readFileSync(podfilePath, 'utf-8')

            if (!podfile.includes('use_modular_headers!')) {
                podfile = podfile.replace(
                    'prepare_react_native_project!\n',
                    'prepare_react_native_project!\nuse_modular_headers!\n'
                )
                fs.writeFileSync(podfilePath, podfile)
            }

            return cfg
        },
    ])
}
