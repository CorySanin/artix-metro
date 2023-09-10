#!/usr/bin/perl

use strict;
use warnings;

undef $/;
my $pkgpath = "~/Documents/pkg/artixlinux";
for (@ARGV) {
    print "Importing $_\n";
    my @gitreset = ("git", "-C", (glob "$pkgpath/$_/"), "reset", "--hard", "HEAD");
    exit 1 if system(@gitreset) != 0;
    my @git = ("git", "-C", (glob "$pkgpath/$_/"), "pull");
    exit 1 if system(@git) != 0;
    my @files = glob "$pkgpath/$_/PKGBUILD";
    exit 1 if @files != 1;
    my $f = $files[0];
    open(FILE,$f);
    my $content = <FILE>;
    close(FILE);
    my @args = ("artixpkg", "repo", "import", "--del", "$_");
    exit 255 if system(@args) != 0;
    eval {
        @files = glob "~/.makepkg.conf";
        my $configfilename = $files[0];
        open(FILE, $configfilename) or die "Failed to open $configfilename";
        my $config = <FILE>;
        close(FILE);
        if ($config =~ /PACKAGER="([^"]+)"/) {
            my @maintainer = ("sed", "-i", "1i# Maintainer: $1", $f);
            exit 2 if system(@maintainer) != 0;
        }
    };
    if ($@) {
        print "$@";
    }
    exit 0 if $content !~ /artix-cmake\s/;
    open(FILE,$f);
    $content = <FILE>;
    close(FILE);
    $content =~ s/(cmake (.|\\\n)*-B)/artix-$1/g;
    open(FILE,">$f");
    print FILE $content;
    close(FILE);
}
