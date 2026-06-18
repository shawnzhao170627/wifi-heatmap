import React, { useEffect } from 'react';
import { StatusBar, ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useStore } from './src/store/useStore';

import HomeScreen from './src/screens/HomeScreen';
import FloorPlanEditor from './src/screens/FloorPlanEditor';
import WifiScannerScreen from './src/screens/WifiScannerScreen';
import HeatmapViewer from './src/screens/HeatmapViewer';

export type RootStackParamList = {
  Home: undefined;
  FloorPlanEditor: { projectId: string };
  WifiScanner: { projectId: string };
  HeatmapViewer: { projectId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

function AppNavigator() {
  const isLoaded = useStore((s) => s.isLoaded);
  const loadProjects = useStore((s) => s.loadProjects);

  useEffect(() => {
    if (!isLoaded) loadProjects();
  }, [isLoaded, loadProjects]);

  if (!isLoaded) return <LoadingScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="FloorPlanEditor" component={FloorPlanEditor} />
        <Stack.Screen name="WifiScanner" component={WifiScannerScreen} />
        <Stack.Screen name="HeatmapViewer" component={HeatmapViewer} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
        <AppNavigator />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7FA' },
});
