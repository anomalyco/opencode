// Override @expo/vector-icons types to fix React 18/19 JSX element type mismatch.
// The library bundles @types/react@18 internally which conflicts with our React 19.
// This declaration makes Ionicons (and other icon sets) work as valid JSX elements.
declare module "@expo/vector-icons" {
  import type { TextProps } from "react-native"

  interface IconProps extends TextProps {
    name: string
    size?: number
    color?: string
    style?: any
  }

  interface IconComponent extends React.FC<IconProps> {
    glyphMap: Record<string, number>
  }

  export const Ionicons: IconComponent
  export const MaterialIcons: IconComponent
  export const MaterialCommunityIcons: IconComponent
  export const FontAwesome: IconComponent
  export const FontAwesome5: IconComponent
  export const Feather: IconComponent
  export const AntDesign: IconComponent
  export const Entypo: IconComponent
  export const EvilIcons: IconComponent
  export const Foundation: IconComponent
  export const Octicons: IconComponent
  export const SimpleLineIcons: IconComponent
  export const Zocial: IconComponent
}
