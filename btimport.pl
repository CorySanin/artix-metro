#!/usr/bin/perl

use strict;
use warnings;

undef $/;
for (@ARGV) {
    my @args = ("buildtree", "-ip", "$_");
    exit 255 if system(@args) == 255;
    my @files = glob "~/Documents/pkg/artixlinux/*/$_/trunk/PKGBUILD";
    exit 1 if @files != 1;
    my $f = $files[0];
    open(FILE,$f);
    my $content = <FILE>;
    close(FILE);
    $content =~ s/(cmake (.|\\\n)*-B)/artix-$1/g;
    open(FILE,">$f");
    print FILE $content;
    close(FILE);
}
