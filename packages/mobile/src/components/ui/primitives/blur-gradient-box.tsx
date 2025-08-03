import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Box, BoxProps } from "./box";
import BlurView from "./blur-view";
import { useUnistyles } from "react-native-unistyles";

export type BlurGradientBoxProps = BoxProps & {
  gradientStart?: { x: number; y: number };
  gradientEnd?: { x: number; y: number };
  blurIntensity?: number;
  children?: React.ReactNode;
};

export const BlurGradientBox = ({
  gradientStart = { x: 0, y: 0 },
  gradientEnd = { x: 1, y: 1 },
  blurIntensity = 40,
  children,
  style,
  ...boxProps
}: BlurGradientBoxProps) => {
  const { rt } = useUnistyles();
  const isDark = rt.themeName === "dark";

  const gradientColors = useMemo(() => {
    return isDark
      ? ([
          "rgba(80,85,100,0.22)", // lighter gray-blue for glass effect
          "rgba(30,32,40,0.18)", // lighter dark for depth
          "rgba(13,15,18,0.7)", // #0d0f12 at 70% opacity]
        ] as const)
      : ([
          "rgba(255,255,255,0.22)", // white with good opacity
          "rgba(180,180,180,0.10)", // even darker grey for contrast
          "rgba(100,100,100,0.02)", // even darker grey for contrast
        ] as const);
  }, [isDark]);

  const containerStyle = useMemo(() => {
    const baseStyle = { overflow: "hidden" as const };

    if (!isDark) {
      return {
        ...baseStyle,
        borderWidth: 1.5,
        borderColor: "rgba(200,200,200,0.5)", // grey border for definition
      };
    }

    return baseStyle;
  }, [isDark]);

  return (
    <Box {...boxProps} border="thin" style={[containerStyle, style]}>
      {/* Glassmorphic background: Blur + gradient */}
      <Box style={{ ...StyleSheet.absoluteFillObject, zIndex: 0 }}>
        <LinearGradient
          colors={gradientColors}
          start={gradientStart}
          end={gradientEnd}
          style={StyleSheet.absoluteFillObject}
        />
        <BlurView
          intensity={blurIntensity}
          style={StyleSheet.absoluteFillObject}
        />
      </Box>

      {/* Content with higher zIndex */}
      {children && (
        <Box style={{ zIndex: 1 }} flex>
          {children}
        </Box>
      )}
    </Box>
  );
};
