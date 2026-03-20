import { describe, it, expect } from 'vitest';
import { Semver, SemverRange } from '../src/model/semver.js';

describe('Semver', () => {
  it('parses major.minor.patch', () => {
    const v = Semver.parse('1.2.3');
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
  });

  it('throws on invalid format', () => {
    expect(() => Semver.parse('1.2')).toThrow();
    expect(() => Semver.parse('abc')).toThrow();
  });

  it('compares versions correctly', () => {
    expect(Semver.parse('2.0.0').compareTo(Semver.parse('1.9.9'))).toBeGreaterThan(0);
    expect(Semver.parse('1.0.0').compareTo(Semver.parse('1.0.1'))).toBeLessThan(0);
    expect(Semver.parse('1.2.3').compareTo(Semver.parse('1.2.3'))).toBe(0);
  });

  it('toString formats correctly', () => {
    expect(Semver.parse('1.2.3').toString()).toBe('1.2.3');
    expect(Semver.parse('0.0.0').toString()).toBe('0.0.0');
  });
});

describe('SemverRange', () => {
  it('caret ^1.2.3 matches within same major', () => {
    const range = new SemverRange('^1.2.3');
    expect(range.matches(Semver.parse('1.2.3'))).toBe(true);
    expect(range.matches(Semver.parse('1.9.9'))).toBe(true);
    expect(range.matches(Semver.parse('2.0.0'))).toBe(false);
    expect(range.matches(Semver.parse('0.9.9'))).toBe(false);
  });

  it('tilde ~1.2.3 matches within minor range', () => {
    const range = new SemverRange('~1.2.3');
    expect(range.matches(Semver.parse('1.2.3'))).toBe(true);
    expect(range.matches(Semver.parse('1.3.0'))).toBe(true);
    expect(range.matches(Semver.parse('1.4.0'))).toBe(false);
    expect(range.matches(Semver.parse('2.0.0'))).toBe(false);
  });

  it('exact 1.2.3 matches only that version', () => {
    const range = new SemverRange('1.2.3');
    expect(range.matches(Semver.parse('1.2.3'))).toBe(true);
    expect(range.matches(Semver.parse('1.2.4'))).toBe(false);
    expect(range.matches(Semver.parse('2.0.0'))).toBe(false);
  });

  it('wildcard * matches anything', () => {
    const range = new SemverRange('*');
    expect(range.matches(Semver.parse('0.0.1'))).toBe(true);
    expect(range.matches(Semver.parse('99.99.99'))).toBe(true);
  });
});
