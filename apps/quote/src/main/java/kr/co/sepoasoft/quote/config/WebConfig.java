package kr.co.sepoasoft.quote.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import kr.co.sepoasoft.quote.web.auth.AccessInterceptor;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AccessInterceptor accessInterceptor;

    public WebConfig(AccessInterceptor accessInterceptor) {
        this.accessInterceptor = accessInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(accessInterceptor).addPathPatterns("/api/**");
    }
}
