import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/auth';
import { COLORS } from './src/config';
import LoginScreen from './src/screens/LoginScreen';
import RequestsScreen from './src/screens/RequestsScreen';
import RequestDetailScreen from './src/screens/RequestDetailScreen';

const Stack = createNativeStackNavigator();
export const navRef = createNavigationContainerRef();

const screenOpts = { headerStyle: { backgroundColor: COLORS.green }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '800' } };

function Root() {
  const { loading, user } = useAuth();

  // Tapping a push notification opens the request it is about.
  useEffect(() => {
    const open = (resp) => {
      const requestId = resp?.notification?.request?.content?.data?.requestId;
      if (requestId && navRef.isReady()) navRef.navigate('RequestDetail', { id: requestId });
    };
    Notifications.getLastNotificationResponseAsync().then((r) => r && setTimeout(() => open(r), 400));
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [user]);

  if (loading) return <View style={{ flex: 1, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" size="large" /><Text style={{ color: '#fff', marginTop: 14, fontWeight: '700' }}>Holiday Dialysis</Text></View>;

  return (
    <NavigationContainer ref={navRef}>
      <Stack.Navigator screenOptions={screenOpts}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Requests" component={RequestsScreen} options={{ title: 'My Requests' }} />
            <Stack.Screen name="RequestDetail" component={RequestDetailScreen} options={({ route }) => ({ title: route.params?.number || 'Request' })} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Root />
    </AuthProvider>
  );
}
