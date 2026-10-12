import { defaultPerThemeSettings } from '@md/shared/configs'

export const YANHUI_THEME = 'mp:yanhui-channel'
export const YANHUI_SAMPLE_ID = 'yanhui-jev-trial'

export function yanhuiDefaults() {
  return {
    ...defaultPerThemeSettings(),
    primaryColor: '#4285f4',
    fontSize: '17px',
    lineHeight: '2.05',
    blockSpacing: '1',
    linkColor: '#356fc0',
    blockquoteBackground: 'transparent',
    isMacCodeBlock: true,
    codeBlockTheme: `${import.meta.env.BASE_URL}yanhui-code.css`,
  }
}
