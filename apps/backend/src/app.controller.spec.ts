import { describe, it, expect } from 'bun:test';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(AppController.getHello()).toBe('Hello World!');
    });
  });
});
