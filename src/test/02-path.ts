/* tslint-env mocha */

import { expect } from 'chai';
import { YAJSPath } from '../main/lib/path/YAJSPath';

describe('path match', () => {

    describe('object', () => {
        it('should match on root', () => {
            const root1 = new YAJSPath.Builder().build();
            const root2 = new YAJSPath.Builder().build();

            expect(root1.match(root2)).to.equal(true);
            expect(root2.match(root1)).to.equal(true);
        });

        it('should match on wildcard', () => {
            const prop1 = new YAJSPath.Builder().
                addChild('prop1').
                build();

            const wildcard = new YAJSPath.Builder().
                addWildcard().
                build();

            expect(wildcard.match(prop1)).to.equal(true);
            expect(prop1.match(wildcard)).to.equal(false);
        });

        it('should match on simple property', () => {
            const path1 = new YAJSPath.Builder().
                addChild('prop1').
                build();

            const path2 = new YAJSPath.Builder().
                addChild('prop1').
                build();

            expect(path1.match(path2)).to.equal(true);
            expect(path2.match(path1)).to.equal(true);
        });

        it('should match on descendant', () => {
            const path1 = new YAJSPath.Builder().
                addChild('prop1').
                addChild('prop2').
                addChild('prop3').
                build();

            const descendant = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3').
                build();

            expect(descendant.match(path1)).to.equal(true);
        });

        it('should match on descendant (filtered)', () => {
            const path1 = new YAJSPath.Builder().
                addChild('prop1').
                addChild('prop2').
                addChild('prop3').
                build();

            const descendant1 = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3', 'prop1', [ 'prop1' ]).
                build();

            const descendant2 = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3', 'prop5', [ 'prop5' ]).
                build();

            const descendant3 = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3', 'prop1 && prop2', [ 'prop1', 'prop2' ]).
                build();

            expect(descendant1.match(path1)).to.equal(true);
            expect(descendant2.match(path1)).to.equal(false);
            expect(descendant3.match(path1)).to.equal(true);
        });
    });

    describe('string', () => {
        it('should match on root', () => {
            const root1 = YAJSPath.parse('$');
            const root2 = YAJSPath.parse('$');

            expect(root1.match(root2)).to.equal(true);
            expect(root2.match(root1)).to.equal(true);
        });

        it('should match on wildcard', () => {
            const prop1 = YAJSPath.parse('$.prop1');
            const wildcard = YAJSPath.parse('$.*');

            expect(wildcard.match(prop1)).to.equal(true);
            expect(prop1.match(wildcard)).to.equal(false);
        });

        it('should match on simple property', () => {
            const path1 = YAJSPath.parse('$.prop1');
            const path2 = YAJSPath.parse('$.prop1');

            expect(path1.match(path2)).to.equal(true);
            expect(path2.match(path1)).to.equal(true);
        });

        it('should match on descendant', () => {
            const path1 = YAJSPath.parse('$.prop1.prop2.prop3');
            const descendant = YAJSPath.parse('$..prop3');

            expect(descendant.match(path1)).to.equal(true);
        });

        it('should match on descendant (filtered)', () => {
            const path1 = YAJSPath.parse('$.prop1.prop2.prop3');

            const descendant1 = YAJSPath.parse('$..[prop1]prop3');
            const descendant2 = YAJSPath.parse('$..[prop5]prop3');
            const descendant3 = YAJSPath.parse('$..[prop1 && prop2]prop3');

            expect(descendant1.match(path1)).to.equal(true);
            expect(descendant2.match(path1)).to.equal(false);
            expect(descendant3.match(path1)).to.equal(true);
        });
    });

});
