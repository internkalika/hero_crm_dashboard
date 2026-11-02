import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { DataProvider } from './state/DataContext';
import './index.css';
import './pages/landing.css';

// The single-file HTML build is opened from disk (file://), where only hash routes work.
const Router = import.meta.env.MODE === 'single' ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <DataProvider>
        <App />
      </DataProvider>
    </Router>
  </React.StrictMode>,
);
