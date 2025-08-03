import React from "react"
import { View } from "react-native"
import { FullWindowOverlay } from "react-native-screens"
import { useSonner } from "@/providers/sonner-provider"
import { SonnerItem } from "@/primitives/sonner-item"
import { StyleSheet } from "react-native-unistyles"

export const SonnerOverlay: React.FC = () => {
  const { sonners, hideSonner } = useSonner()

  if (sonners.length === 0) {
    return null
  }

  return (
    <FullWindowOverlay>
      <View style={styles.overlay} pointerEvents="box-none">
        {sonners.map((sonner, index) => (
          <SonnerItem key={sonner.id} sonner={sonner} onRemove={hideSonner} index={index} />
        ))}
      </View>
    </FullWindowOverlay>
  )
}

const styles = StyleSheet.create(() => ({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    pointerEvents: "box-none",
  },
}))
