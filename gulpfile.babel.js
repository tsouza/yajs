import gulp from 'gulp';
import ts from 'gulp-typescript';
import del from 'del';

const tsProject = ts.createProject('tsconfig.json');

gulp.task('clean', () => del('dist'));

gulp.task('compile', () =>
    tsProject.src().
        pipe(tsProject())
        .js.pipe(gulp.dest('dist')));