{ pkgs, ... }:

{
  packages = [ pkgs.git pkgs.chromium ];

  env.CHROMIUM_PATH = "${pkgs.chromium}/bin/chromium";

  languages.javascript = {
    enable = true;
    npm.enable = true;
  };
}
