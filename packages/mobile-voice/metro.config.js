const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Required for react-native-executorch model files
config.resolver.assetExts.push('pte', 'bin');

module.exports = config;
