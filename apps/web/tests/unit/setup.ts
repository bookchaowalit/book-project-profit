import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Cold start of the first jsdom render under parallel workers can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });
