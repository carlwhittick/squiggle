{ pkgs, lib, ... }:

let
  nunito = pkgs.runCommand "nunito-font" {} ''
    mkdir -p $out/share/fonts/truetype
    cp ${pkgs.fetchurl {
      url = "https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf";
      hash = "sha256-u1WlylwgQjNbOZGvJ8TQcF0O9BysYWSsc3/Y8qHoUgc=";
    }} $out/share/fonts/truetype/Nunito.ttf
  '';
in
{
  packages = [
    pkgs.git
    pkgs.chromium
    pkgs.liberation_ttf   # Liberation Sans / Serif / Mono (Arial / Times / Courier substitutes)
    pkgs.dejavu_fonts     # DejaVu Sans / Serif / Sans Mono
    nunito                # Google Font — matches system-ui on this machine
  ];

  env.CHROMIUM_PATH = "${pkgs.chromium}/bin/chromium";

  languages.javascript = {
    enable = true;
    npm.enable = true;
  };
}
