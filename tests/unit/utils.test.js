
import { describe, it, expect } from 'vitest';
import { cleanText } from '../../core/utils.js';

describe('core/utils.js - cleanText', () => {
    it('應該移除多餘的換行符號', () => {
        const input = 'Hello\n\n\nWorld';
        expect(cleanText(input)).toBe('Hello\nWorld');
    });

    it('應該移除頭尾空白', () => {
        const input = '   Space   ';
        expect(cleanText(input)).toBe('Space');
    });

    it('如果傳入 null，應該回傳空字串', () => {
        expect(cleanText(null)).toBe('');
    });
});
