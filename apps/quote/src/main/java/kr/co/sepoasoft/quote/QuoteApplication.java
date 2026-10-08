package kr.co.sepoasoft.quote;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.support.SpringBootServletInitializer;

/**
 * 애플리케이션 진입점.
 *
 * <p>외부 Tomcat 에 WAR 로 배포하므로 {@link SpringBootServletInitializer} 를 상속하고
 * {@code configure()} 를 오버라이드한다. 이것이 없으면 WAR 는 배포되는데 서블릿 컨텍스트가
 * 초기화되지 않아 404 만 돌아온다 — 로그에도 뚜렷한 오류가 남지 않는 조용한 실패다.
 *
 * <p>{@code mvnw spring-boot:run} 으로 내장 Tomcat 을 띄우는 경로도 그대로 동작한다.
 */
@SpringBootApplication
public class QuoteApplication extends SpringBootServletInitializer {

    @Override
    protected SpringApplicationBuilder configure(SpringApplicationBuilder builder) {
        return builder.sources(QuoteApplication.class);
    }

    public static void main(String[] args) {
        SpringApplication.run(QuoteApplication.class, args);
    }
}
