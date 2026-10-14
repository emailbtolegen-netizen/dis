import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import kkKZ from 'antd/locale/kk_KZ';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { getLang } from './lib/i18n';
import { SessionProvider } from './lib/session';
import './styles.css';

dayjs.locale('ru');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={getLang() === 'kk' ? kkKZ : ruRU}
      theme={{
        token: {
          colorPrimary: '#1f4e79',
          colorInfo: '#1f4e79',
          colorInfoBg: '#eef4fb',
          colorInfoBorder: '#c3d6ec',
          colorText: '#1f2933',
          colorTextSecondary: '#52606d',
          colorBgLayout: '#f2f4f7',
          borderRadius: 6,
          fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          fontSize: 14,
        },
        components: {
          Layout: { siderBg: '#1b2a3a', headerBg: '#ffffff', headerHeight: 56, headerPadding: '0 16px' },
          Menu: { darkItemBg: '#1b2a3a', darkSubMenuItemBg: '#152231', darkItemSelectedBg: '#1f4e79' },
          Table: { headerBg: '#f5f7fa', headerColor: '#334e68', rowHoverBg: '#f0f5fb', cellPaddingBlockSM: 6 },
          Card: { headerFontSize: 15 },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
