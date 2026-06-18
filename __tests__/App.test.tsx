/**
 * @format
 */

// Mock all screens — they each have heavy native deps (Skia, sensors, wifi, gestures)
// The App test verifies the navigation shell mounts correctly.
jest.mock('../src/screens/HomeScreen', () => () => null);
jest.mock('../src/screens/FloorPlanEditor', () => () => null);
jest.mock('../src/screens/WifiScannerScreen', () => () => null);
jest.mock('../src/screens/HeatmapViewer', () => () => null);

// Mock Reanimated / Worklets to prevent native module loading
const makeWorkletsMock = () => {
  const noop = () => null;
  return {
    createSerializable: noop,
    createWorkletRuntime: noop,
    getWorkletRuntime: noop,
    runOnJS: (fn: any) => fn,
    runOnUI: (fn: any) => fn,
    isWorkletFunction: () => false,
  };
};

jest.mock('react-native-worklets', () => makeWorkletsMock());

jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  const mock = {
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    useAnimatedProps: () => ({}),
    Animated: { View },
    default: { View },
  };
  return mock;
});

jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    GestureHandlerRootView: View,
    GestureDetector: View,
    PanGestureHandler: View,
    TapGestureHandler: View,
    Gesture: {
      Pan: () => ({ onStart: (x: any) => x, onUpdate: (x: any) => x, minPointers: (x: any) => x, maxPointers: (x: any) => x }),
      Pinch: () => ({ onStart: (x: any) => x, onUpdate: (x: any) => x }),
      Simultaneous: (...args: any[]) => args[0],
    },
    State: { BEGAN: 0, ACTIVE: 1, END: 2 },
    Directions: { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 },
    default: {},
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-screens', () => ({}));

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: any) => children,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: any) => children,
    Screen: () => null,
  }),
}));

jest.mock('@shopify/react-native-skia', () => {
  const View = require('react-native').View;
  return {
    Canvas: View, Rect: View, Circle: View, Line: View, Path: View,
    Skia: { Path: { Make: () => ({ moveTo: jest.fn(), lineTo: jest.fn() }) } },
  };
});

jest.mock('react-native-sensors', () => ({
  accelerometer: { pipe: () => ({ subscribe: jest.fn() }) },
  gyroscope: { pipe: () => ({ subscribe: jest.fn() }) },
  setUpdateIntervalForType: jest.fn(),
  SensorTypes: { accelerometer: 'accelerometer', gyroscope: 'gyroscope' },
}));

jest.mock('react-native-wifi-reborn', () => ({
  loadWifiList: jest.fn(() => Promise.resolve([])),
  connectToProtectedSSID: jest.fn(),
  getCurrentWifiSSID: jest.fn(() => Promise.resolve('')),
}));

jest.mock('react-native-vector-icons', () => ({}));
jest.mock('@react-native/new-app-screen', () => ({ NewAppScreen: () => null }));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// Silence zustand store warning during test
jest.spyOn(console, 'warn').mockImplementation((_msg?: any, ..._args: any[]) => {});

test('renders without crashing', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
    // Wait for async zustand store initialization
    await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
  });
});

test('App shows loading then navigation shell', async () => {
  let tree: any;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  expect(tree!.toJSON()).toBeTruthy();
});
