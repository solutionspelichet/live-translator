import { Text as RNText, TextInput as RNTextInput } from 'react-native';

import { t } from './index.js';

const translate = (children) => {
  if (typeof children === 'string') return t(children);
  if (Array.isArray(children)) return children.map((c) => (typeof c === 'string' ? t(c) : c));
  return children;
};

/** `Text` that shows the French texts of the app in the chosen interface language (texts that are not in the catalog are untouched). */
export function Text({ children, ...props }) {
  return <RNText {...props}>{translate(children)}</RNText>;
}

export function TextInput({ placeholder, ...props }) {
  return <RNTextInput {...props} placeholder={typeof placeholder === 'string' ? t(placeholder) : placeholder} />;
}
