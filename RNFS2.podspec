require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RNFS2"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors         = {
    "Johannes Lumpe" => "johannes@lum.pe",
    "Hagen Hübel" => "hhuebel@itinance.com",
    "Connor Tumbleson" => "connor@sourcetoad.com"
  }

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/sourcetoad/react-native-fs2.git", :tag => "v#{s.version}" }
  s.resource_bundles = { 'RNFS_PrivacyInfo' => 'ios/PrivacyInfo.xcprivacy' }
  s.source_files = "ios/**/*.{h,m,mm,swift}"

  load 'nitrogen/generated/ios/RNFS2+autolinking.rb'
  add_nitrogen_files(s)

 install_modules_dependencies(s)
end
