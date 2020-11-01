import gulp from 'gulp';
import gulpCopy from 'gulp-copy';
import ts from 'gulp-typescript';
import del from 'del';
import merge from 'merge2'

const tsProject = ts.createProject('tsconfig.json');

gulp.task('clean', () => del('dist'));

gulp.task('compile', () => {
    let tsResult = tsProject.src().pipe(tsProject());
    return merge([
        tsResult.js.pipe(gulp.dest('dist')),
        tsResult.dts.pipe(gulp.dest('dist'))
    ]);
});


gulp.task('test-copy-data', () =>
    gulp.
        src('src/test/**/*.json').
        pipe(gulpCopy('dist', { prefix: 1 })))
