import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { ThemeProvider } from './context/theme';
import { SessionProvider } from './context/session';
import { ModalProvider } from './context/modal';
import Routing from './routes/routing';

function App() {
  return (
    <ThemeProvider>
      <Router>
        <SessionProvider>
          <ModalProvider>
            <Routing />
          </ModalProvider>
        </SessionProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;
