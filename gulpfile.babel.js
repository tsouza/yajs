import gulp from 'gulp';
import gulpCopy from 'gulp-copy';
import ts from 'gulp-typescript';
import del from 'del';

const tsProject = ts.createProject('tsconfig.json');

gulp.task('clean', () => del('dist'));

gulp.task('compile', () =>
    tsProject.src().
        pipe(tsProject()).
        js.pipe(gulp.dest('dist')));


gulp.task('test-copy-data', () =>
    gulp.
        src('src/test/**/*.json').
        pipe(gulpCopy('dist', { prefix: 1 })))
