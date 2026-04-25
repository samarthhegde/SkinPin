const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("tflite")) {
  config.resolver.assetExts.push("tflite");
}

module.exports = config;
