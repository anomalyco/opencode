const env = process.env.EXPO_PUBLIC_ENV
const bundleIdentifier = env ? `ai.opencode.mobile.${env}` : `ai.opencode.mobile`
const scheme = env ? `opencode${env}` : `opencode`

const name = env ? `opencode (${env.toUpperCase()})` : "opencode"

const config = {
  expo: {
    name,
    slug: "opencode",
    version: "0.0.1",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme,
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: false,
      bundleIdentifier: bundleIdentifier,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      package: bundleIdentifier,
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
      ],
      [
        "expo-secure-store",
        {
          faceIDPermission: "Allow $(PRODUCT_NAME) to access your Face ID biometric data.",
        },
      ],
      "expo-web-browser",
      "expo-build-properties",
      "expo-sqlite",
      "react-native-edge-to-edge",
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.0",
          },
          android: {
            compileSdkVersion: 35,
          },
        },
      ],
      [
        "expo-font",
        {
          fonts: ["./assets/fonts/SpaceMono-Regular.ttf"],
        },
      ],
      [
        "react-native-vision-camera",
        {
          cameraPermissionText: "$(PRODUCT_NAME) needs access to your Camera. To Scan QR Codes.",

          // optionally, if you want to record audio:
          enableMicrophonePermission: false,
          enableCodeScanner: true,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    runtimeVersion: "0.0.1",
    extra: {
      eas: {
        projectId: "1ee94294-051d-4a43-8c88-aa581cf3bc69",
      },
    },
    updates: {
      url: "https://u.expo.dev/1ee94294-051d-4a43-8c88-aa581cf3bc69",
    },
    owner: "opencode-ai",
  },
}

export default config
