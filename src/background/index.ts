import EurekaLiteController from './controllers';

// Add instance to window for debugging
const controller = new EurekaLiteController();
Object.assign(window, { controller });
