import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';

import { familyFor } from '../theme/fonts.js';
import { t } from './index.js';

const translate = (children) => {
  if (typeof children === 'string') return t(children);
  if (Array.isArray(children)) return children.map((c) => (typeof c === 'string' ? t(c) : c));
  return children;
};

/** Adds the app typeface to a style: the family of its weight (Android needs one font file per weight), the weight itself reset. */
function withFont(style) {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  const family = familyFor(flat.fontWeight);
  return family ? [style, { fontFamily: family, fontWeight: 'normal' }] : style;
}

/** `Text` that shows the French texts of the app in the chosen interface language (texts that are not in the catalog are untouched). */
export function Text({ children, style, ...props }) {
  return (
    <RNText style={withFont(style)} {...props}>
      {translate(children)}
    </RNText>
  );
}

/** Text with the app typeface but WITHOUT translation (dynamic content: what people said, what was translated). */
export function Plain({ style, ...props }) {
  return <RNText style={withFont(style)} {...props} />;
}

export function TextInput({ placeholder, style, ...props }) {
  return <RNTextInput style={withFont(style)} placeholder={typeof placeholder === 'string' ? t(placeholder) : placeholder} {...props} />;
}
