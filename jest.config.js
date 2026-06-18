const config = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!(' +
    '@react-native|react-native|@react-navigation|@react-native-async-storage' +
    '|@shopify/react-native-skia|react-native-gesture-handler|react-native-reanimated' +
    '|react-native-safe-area-context|react-native-screens|react-native-permissions' +
    '|react-native-sensors|react-native-wifi-reborn|react-native-worklets' +
    '|react-native-vector-icons|zustand' +
    ')/)',
  ],
};

module.exports = config;
