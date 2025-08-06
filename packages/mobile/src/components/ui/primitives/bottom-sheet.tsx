import { forwardRef, useImperativeHandle, useRef } from "react"
import type { ReactNode } from "react"
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView } from "@gorhom/bottom-sheet"
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet"
import { useUnistyles } from "react-native-unistyles"

interface BottomSheetProps {
  children: ReactNode
  snapPoints?: string[] | number[]
  onDismiss?: () => void
  enablePanDownToClose?: boolean
  backdropOpacity?: number
  index?: number
  keyboardBehavior?: "extend" | "fillParent" | "interactive"
  keyboardBlurBehavior?: "none" | "restore"
}

export interface BottomSheetRef {
  present: () => void
  dismiss: () => void
  snapToIndex: (index: number) => void
  snapToPosition: (position: string | number) => void
}

export const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
  (
    {
      children,
      snapPoints = ["60%"],
      onDismiss,
      enablePanDownToClose = true,
      backdropOpacity = 0.75,
      index = 0,
      keyboardBehavior = "interactive",
      keyboardBlurBehavior = "none",
      ...props
    },
    ref,
  ) => {
    const { theme } = useUnistyles()
    const bottomSheetModalRef = useRef<BottomSheetModal>(null)
    const styles = createStyles(theme)

    useImperativeHandle(ref, () => ({
      present: () => bottomSheetModalRef.current?.present(),
      dismiss: () => bottomSheetModalRef.current?.dismiss(),
      snapToIndex: (index: number) => bottomSheetModalRef.current?.snapToIndex(index),
      snapToPosition: (position: string | number) => bottomSheetModalRef.current?.snapToPosition(position),
    }))

    const renderBackdrop = (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={backdropOpacity}
        style={[props.style, { backgroundColor: "rgba(0, 0, 0, 0.8)" }]}
      />
    )

    return (
      <BottomSheetModal
        ref={bottomSheetModalRef}
        snapPoints={snapPoints}
        onDismiss={onDismiss}
        backdropComponent={renderBackdrop}
        enablePanDownToClose={enablePanDownToClose}
        index={index}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.handleIndicator}
        keyboardBehavior={keyboardBehavior}
        keyboardBlurBehavior={keyboardBlurBehavior}
        {...props}
      >
        {children}
      </BottomSheetModal>
    )
  },
)

const createStyles = (theme: any) => ({
  background: {
    backgroundColor: theme.colors.background.base,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: theme.colors.border.subtle,
  },
  handleIndicator: {
    backgroundColor: theme.colors.border.default,
    width: 40,
    height: 4,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.base,
  },
})

BottomSheet.displayName = "BottomSheet"
