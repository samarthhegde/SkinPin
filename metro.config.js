const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("tflite")) {
  config.resolver.assetExts.push("tflite");
}

// Prevent accidental nested projects inside the route folder from being bundled.
const nestedAppNodeModules = path.resolve(__dirname, "app/node_modules");
config.resolver.blockList = [
  new RegExp(`${nestedAppNodeModules.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/.*`),
];

module.exports = config;
