import { BlurView as ExpoBlurView, type BlurViewProps } from "expo-blur";
import { useUnistyles } from "react-native-unistyles";

const BlurView = ({ children, ...props }: BlurViewProps) => {
  const { rt } = useUnistyles();
  return (
    <ExpoBlurView tint={rt.themeName === "dark" ? "dark" : "light"} {...props}>
      {children}
    </ExpoBlurView>
  );
};

export default BlurView;
