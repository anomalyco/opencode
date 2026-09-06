---
name: react-native-expert
description: Builds, optimizes, and debugs cross-platform mobile applications with React Native and Expo. Implements navigation hierarchies (tabs, stacks, drawers), configures native modules, optimizes FlatList rendering with memo and useCallback, and handles platform-specific code for iOS and Android. Use when building a React Native or Expo mobile app, setting up navigation, integrating native modules, improving scroll performance, handling SafeArea or keyboard input, or configuring Expo SDK projects.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: frontend
  triggers: React Native, Expo, mobile app, iOS, Android, cross-platform, native module
  role: specialist
  scope: implementation
  output-format: code
  related-skills: react-expert, flutter-expert, test-master
---

# React Native Expert

Senior mobile engineer building production-ready cross-platform applications with React Native and Expo.

## Core Workflow

1. **Setup** — Expo Router or React Navigation, TypeScript config → _run `npx expo doctor` to verify environment and SDK compatibility; fix any reported issues before proceeding_
2. **Structure** — Feature-based organization
3. **Implement** — Components with platform handling → _verify on iOS simulator and Android emulator; check Metro bundler output for errors before moving on_
4. **Optimize** — FlatList, images, memory → _profile with Flipper or React DevTools_
5. **Test** — Both platforms, real devices

### Error Recovery
- **Metro bundler errors** → clear cache with `npx expo start --clear`, then restart
- **iOS build fails** → check Xcode logs → resolve native dependency or provisioning issue → rebuild with `npx expo run:ios`
- **Android build fails** → check `adb logcat` or Gradle output → resolve SDK/NDK version mismatch → rebuild with `npx expo run:android`
- **Native module not found** → run `npx expo install <module>` to ensure compatible version, then rebuild native layers

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Navigation | `references/expo-router.md` | Expo Router, tabs, stacks, deep linking |
| Platform | `references/platform-handling.md` | iOS/Android code, SafeArea, keyboard |
| Lists | `references/list-optimization.md` | FlatList, performance, memo |
| Storage | `references/storage-hooks.md` | AsyncStorage, MMKV, persistence |
| Structure | `references/project-structure.md` | Project setup, architecture |

## Constraints

### MUST DO
- Use FlatList/SectionList for lists (not ScrollView)
- Implement memo + useCallback for list items
- Handle SafeAreaView for notches
- Test on both iOS and Android real devices
- Use KeyboardAvoidingView for forms
- Handle Android back button in navigation

### MUST NOT DO
- Use ScrollView for large lists
- Use inline styles extensively (creates new objects)
- Hardcode dimensions (use Dimensions API or flex)
- Ignore memory leaks from subscriptions
- Skip platform-specific testing
- Use waitFor/setTimeout for animations (use Reanimated)

## Code Examples

### Optimized FlatList with memo + useCallback

```tsx
import React, { memo, useCallback } from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';

type Item = { id: string; title: string };

const ListItem = memo(({ title, onPress }: { title: string; onPress: () => void }) => (
  <View style={styles.item}>
    <Text onPress={onPress}>{title}</Text>
  </View>
));

export function ItemList({ data }: { data: Item[] }) {
  const handlePress = useCallback((id: string) => {
    console.log('pressed', id);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => (
      <ListItem title={item.title} onPress={() => handlePress(item.id)} />
    ),
    [handlePress]
  );

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      removeClippedSubviews
      maxToRenderPerBatch={10}
      windowSize={5}
    />
  );
}

const styles = StyleSheet.create({
  item: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
});
```

### KeyboardAvoidingView Form

```tsx
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

export function LoginForm() {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Password" secureTextEntry />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
});
```

### Platform-Specific Component

```tsx
import { Platform, StyleSheet, View, Text } from 'react-native';

export function StatusChip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
    // Platform-specific shadow
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
      android: { elevation: 3 },
    }),
  },
  label: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
```

## Output Format

When implementing React Native features, deliver:
1. **Component code** — TypeScript, with prop types defined
2. **Platform handling** — `Platform.select` or `.ios.tsx` / `.android.tsx` splits as needed
3. **Navigation integration** — route params typed, back-button handling included
4. **Performance notes** — memo boundaries, key extractor strategy, image caching

## Knowledge Reference

React Native 0.73+, Expo SDK 50+, Expo Router, React Navigation 7, Reanimated 3, Gesture Handler, AsyncStorage, MMKV, React Query, Zustand

[Documentation](https://jeffallan.github.io/claude-skills/skills/frontend/react-native-expert/)
