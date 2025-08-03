import React from "react";
import { Pressable, Animated } from "react-native";
import type { PressableProps, ViewStyle, StyleProp } from "react-native";

const AnPressable = Animated.createAnimatedComponent(Pressable);

type AnimatedPressableProps = PressableProps & {
  children: React.ReactNode;
  scaleAmount?: number;
  style?: StyleProp<ViewStyle>;
  onPressIn?: () => void;
  onPressOut?: () => void;
};

const AnimatedPressable = ({
  children,
  scaleAmount = 0.9,
  style,
  ...props
}: AnimatedPressableProps) => {
  const scale = React.useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    props.onPressIn?.();
    Animated.spring(scale, {
      toValue: scaleAmount,
      useNativeDriver: true,
      friction: 8,
      tension: 100,
    }).start();
  };

  const onPressOut = () => {
    props.onPressOut?.();
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 100,
    }).start();
  };

  return (
    <AnPressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      {...props}
      style={[{ transform: [{ scale }] }, style]}
    >
      {children}
    </AnPressable>
  );
};

export default AnimatedPressable;
