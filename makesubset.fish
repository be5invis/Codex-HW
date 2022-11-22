#!/usr/bin/env fish

# requires python packages: fonttools brotli
#
# TODO: need to figure out how to preserve ligatures?


for f in ./dist/iosevkalyteweb/woff2/*.woff2
	not string match "*.subset.woff2" $f >/dev/null && set -a files $f
end

if command -v parallel >/dev/null
	echo "Starting GNU Parallel. It may take a bit for jobs to start finishing."
	parallel --bar --progress --eta pyftsubset --name-IDs+=0,4,6 --text-file=./subset-glyphs.txt --flavor=woff2 ::: $files
else
	set fish_trace on
	for f in $_files
		pyftsubset $f --name-IDs+=0,4,6 --text-file=./subset-glyphs.txt --flavor=woff2
	end
end
