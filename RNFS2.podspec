require 'json'
pjson = JSON.parse(File.read('package.json'))

Pod::Spec.new do |s|
  s.name            = "RNFS2"
  s.version         = pjson["version"]
  s.homepage        = "https://github.com/sourcetoad/react-native-fs2"
  s.summary         = pjson["description"]
  s.license         = pjson["license"]
  s.authors         = {
    "Johannes Lumpe" => "johannes@lum.pe",
    "Hagen Hübel" => "hhuebel@itinance.com",
    "Connor Tumbleson" => "connor@sourcetoad.com"
  }

  s.ios.deployment_target = '12.4'

  s.source          = { :git => "https://github.com/sourcetoad/react-native-fs2", :tag => "v#{s.version}" }
  s.source_files    = "ios/*.{h,m}"
  s.preserve_paths  = "src/*.{js,ts}"

  s.dependency 'React-Core'
end
