import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth.jsx';
import { BrandingProvider } from './branding.jsx';
import { UiProvider } from './components/ui.jsx';
import App from './App.jsx';
import { TerminologyProvider } from './terms.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <BrandingProvider>
        <AuthProvider>
          <UiProvider>
            <TerminologyProvider>
              <App />
            </TerminologyProvider>
          </UiProvider>
        </AuthProvider>
      </BrandingProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
