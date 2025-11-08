package com.example.theme;

import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;
import java.util.stream.*;
import java.time.*;
import java.time.format.*;
import java.net.*;
import java.io.*;
import java.nio.file.*;
import java.sql.*;
import java.lang.annotation.*;
import java.math.BigDecimal;
import java.math.BigInteger;

// Enum definition
public enum LogLevel {
    DEBUG(0, "Debug"),
    INFO(1, "Info"),
    WARN(2, "Warning"),
    ERROR(3, "Error");
    
    private final int level;
    private final String description;
    
    LogLevel(int level, String description) {
        this.level = level;
        this.description = description;
    }
    
    public int getLevel() { return level; }
    public String getDescription() { return description; }
}

// Interface with generics
public interface Repository<T extends Entity> {
    Optional<T> findById(Long id);
    List<T> findAll();
    T save(T entity);
    void delete(Long id);
    Stream<T> stream();
    
    @FunctionalInterface
    interface Predicate<T> {
        boolean test(T t);
    }
}

// Abstract class
public abstract class AbstractService<T extends Entity> implements Repository<T> {
    protected final Map<Long, T> cache = new ConcurrentHashMap<>();
    protected volatile boolean initialized = false;
    
    @Override
    public Optional<T> findById(Long id) {
        return Optional.ofNullable(cache.get(id));
    }
    
    @Override
    public List<T> findAll() {
        return new ArrayList<>(cache.values());
    }
    
    @Override
    public Stream<T> stream() {
        return cache.values().stream();
    }
    
    protected abstract void validate(T entity) throws ValidationException;
}

// Annotation definition
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface Service {
    String value() default "";
    boolean transactional() default true;
    Class<?>[] exceptions() = {};
}

// Record class (Java 14+)
public record User(
    Long id,
    String username,
    String email,
    @Deprecated String fullName,
    LocalDateTime createdAt,
    boolean active
) implements Entity {
    
    public User {
        Objects.requireNonNull(username, "Username cannot be null");
        Objects.requireNonNull(email, "Email cannot be null");
        Objects.requireNonNull(createdAt, "Created date cannot be null");
    }
    
    public static User of(String username, String email) {
        return new User(null, username, email, null, LocalDateTime.now(), true);
    }
    
    public User withId(Long id) {
        return new User(id, username, email, fullName, createdAt, active);
    }
}

// Exception classes
public class ValidationException extends RuntimeException {
    private final List<String> errors;
    
    public ValidationException(String message) {
        super(message);
        this.errors = List.of(message);
    }
    
    public ValidationException(List<String> errors) {
        super(String.join(", ", errors));
        this.errors = Collections.unmodifiableList(errors);
    }
    
    public List<String> getErrors() { return errors; }
}

public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String resource, Long id) {
        super(String.format("%s with id %d not found", resource, id));
    }
}

// Service implementation
@Service(value = "userService", transactional = true)
public class UserService extends AbstractService<User> {
    
    private static final Logger logger = LoggerFactory.getLogger(UserService.class);
    private static final int MAX_RETRY_ATTEMPTS = 3;
    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    
    private final EmailService emailService;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    
    @Inject
    public UserService(EmailService emailService, 
                       UserRepository userRepository,
                       PasswordEncoder passwordEncoder) {
        this.emailService = emailService;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }
    
    @Override
    protected void validate(User user) throws ValidationException {
        List<String> errors = new ArrayList<>();
        
        if (user.username() == null || user.username().trim().isEmpty()) {
            errors.add("Username is required");
        } else if (!user.username().matches("^[a-zA-Z0-9_]{3,20}$")) {
            errors.add("Username must be 3-20 characters, alphanumeric and underscore only");
        }
        
        if (user.email() == null || !user.email().matches("^[A-Za-z0-9+_.-]+@(.+)$")) {
            errors.add("Valid email is required");
        }
        
        if (!errors.isEmpty()) {
            throw new ValidationException(errors);
        }
    }
    
    @Transactional
    public User createUser(CreateUserRequest request) throws ValidationException {
        logger.info("Creating new user: {}", request.username());
        
        // Check if user already exists
        if (userRepository.findByUsername(request.username()).isPresent()) {
            throw new ValidationException("Username already exists");
        }
        
        if (userRepository.findByEmail(request.email()).isPresent()) {
            throw new ValidationException("Email already exists");
        }
        
        // Create new user
        User user = User.of(request.username(), request.email())
            .withId(generateId());
        
        validate(user);
        
        try {
            User savedUser = userRepository.save(user);
            cache.put(savedUser.id(), savedUser);
            
            // Send welcome email asynchronously
            CompletableFuture.runAsync(() -> 
                emailService.sendWelcomeEmail(savedUser)
            ).exceptionally(throwable -> {
                logger.error("Failed to send welcome email to user {}", savedUser.id(), throwable);
                return null;
            });
            
            logger.info("Successfully created user with ID: {}", savedUser.id());
            return savedUser;
            
        } catch (DataAccessException e) {
            logger.error("Database error while creating user", e);
            throw new ServiceException("Failed to create user", e);
        }
    }
    
    public Optional<User> findByUsername(String username) {
        return cache.values().stream()
            .filter(user -> user.username().equals(username))
            .findFirst();
    }
    
    public List<User> findActiveUsers() {
        return cache.values().stream()
            .filter(User::active)
            .sorted(Comparator.comparing(User::createdAt).reversed())
            .collect(Collectors.toList());
    }
    
    @Retry(maxAttempts = MAX_RETRY_ATTEMPTS, backoff = @Backoff(delay = 1000))
    public User updateUser(Long id, UpdateUserRequest request) {
        User existingUser = findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("User", id));
        
        User updatedUser = new User(
            id,
            request.username() != null ? request.username() : existingUser.username(),
            request.email() != null ? request.email() : existingUser.email(),
            existingUser.fullName(),
            existingUser.createdAt(),
            request.active() != null ? request.active() : existingUser.active()
        );
        
        validate(updatedUser);
        
        try {
            User savedUser = userRepository.save(updatedUser);
            cache.put(id, savedUser);
            return savedUser;
        } catch (DataAccessException e) {
            logger.error("Failed to update user with ID: {}", id, e);
            throw new ServiceException("Failed to update user", e);
        }
    }
    
    @Async
    public CompletableFuture<Void> deleteUser(Long id) {
        return CompletableFuture.runAsync(() -> {
            try {
                userRepository.deleteById(id);
                cache.remove(id);
                logger.info("Successfully deleted user with ID: {}", id);
            } catch (DataAccessException e) {
                logger.error("Failed to delete user with ID: {}", id, e);
                throw new ServiceException("Failed to delete user", e);
            }
        });
    }
    
    private Long generateId() {
        return System.currentTimeMillis() + (long)(Math.random() * 1000);
    }
}

// Utility class
public final class DateUtils {
    
    private DateUtils() {
        // Utility class - prevent instantiation
    }
    
    private static final DateTimeFormatter ISO_FORMATTER = 
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
    
    public static String formatIsoDateTime(LocalDateTime dateTime) {
        return dateTime.atZone(ZoneId.systemDefault()).format(ISO_FORMATTER);
    }
    
    public static LocalDateTime parseIsoDateTime(String isoString) {
        return LocalDateTime.parse(isoString, ISO_FORMATTER);
    }
    
    public static boolean isWithinLastDays(LocalDateTime dateTime, int days) {
        return dateTime.isAfter(LocalDateTime.now().minusDays(days));
    }
}

// Builder pattern
public class UserQueryBuilder {
    private String username;
    private String email;
    private Boolean active;
    private LocalDateTime createdAfter;
    private LocalDateTime createdBefore;
    private SortOrder sortOrder = SortOrder.ASC;
    private String sortBy = "createdAt";
    private int limit = 100;
    private int offset = 0;
    
    public UserQueryBuilder withUsername(String username) {
        this.username = username;
        return this;
    }
    
    public UserQueryBuilder withEmail(String email) {
        this.email = email;
        return this;
    }
    
    public UserQueryBuilder activeOnly(boolean active) {
        this.active = active;
        return this;
    }
    
    public UserQueryBuilder createdAfter(LocalDateTime date) {
        this.createdAfter = date;
        return this;
    }
    
    public UserQueryBuilder createdBefore(LocalDateTime date) {
        this.createdBefore = date;
        return this;
    }
    
    public UserQueryBuilder sortBy(String field, SortOrder order) {
        this.sortBy = field;
        this.sortOrder = order;
        return this;
    }
    
    public UserQueryBuilder limit(int limit) {
        this.limit = Math.max(1, Math.min(limit, 1000));
        return this;
    }
    
    public UserQueryBuilder offset(int offset) {
        this.offset = Math.max(0, offset);
        return this;
    }
    
    public UserQuery build() {
        return new UserQuery(username, email, active, createdAfter, createdBefore, 
                            sortBy, sortOrder, limit, offset);
    }
}

// Lambda expressions and streams
public class StreamProcessor {
    
    private static final Map<String, Function<String, Object>> TYPE_CONVERTERS = Map.of(
        "string", s -> s,
        "int", Integer::parseInt,
        "double", Double::parseDouble,
        "boolean", Boolean::parseBoolean,
        "bigdecimal", BigDecimal::new,
        "bigint", BigInteger::new
    );
    
    public Map<String, Object> processConfig(Properties properties) {
        return properties.entrySet().stream()
            .filter(entry -> entry.getKey() instanceof String)
            .filter(entry -> entry.getValue() != null)
            .collect(Collectors.toMap(
                entry -> (String) entry.getKey(),
                entry -> convertValue((String) entry.getKey(), (String) entry.getValue())
            ));
    }
    
    private Object convertValue(String key, String value) {
        String type = determineType(key, value);
        return TYPE_CONVERTERS.getOrDefault(type, Function.identity()).apply(value);
    }
    
    private String determineType(String key, String value) {
        if (value.equalsIgnoreCase("true") || value.equalsIgnoreCase("false")) {
            return "boolean";
        } else if (value.matches("-?\\d+")) {
            return "int";
        } else if (value.matches("-?\\d*\\.\\d+")) {
            return "double";
        } else if (key.toLowerCase().contains("amount") || key.toLowerCase().contains("price")) {
            return "bigdecimal";
        }
        return "string";
    }
    
    public List<String> validateEmails(List<String> emails) {
        return emails.stream()
            .filter(Objects::nonNull)
            .map(String::trim)
            .filter(email -> !email.isEmpty())
            .filter(email -> email.matches("^[A-Za-z0-9+_.-]+@(.+)$"))
            .distinct()
            .collect(Collectors.toList());
    }
    
    public CompletableFuture<List<User>> processUsersAsync(List<User> users) {
        return CompletableFuture.supplyAsync(() -> 
            users.parallelStream()
                .filter(User::active)
                .filter(user -> user.createdAt().isAfter(LocalDateTime.now().minusYears(1)))
                .sorted(Comparator.comparing(User::username))
                .collect(Collectors.toList())
        );
    }
}

// Main class for testing
public class Main {
    private static final Logger logger = LoggerFactory.getLogger(Main.class);
    
    public static void main(String[] args) {
        try {
            // Initialize application context
            ApplicationContext context = new AnnotationConfigApplicationContext(AppConfig.class);
            
            // Get service bean
            UserService userService = context.getBean(UserService.class);
            
            // Create test users
            List<User> users = Arrays.asList(
                User.of("john_doe", "john@example.com"),
                User.of("jane_smith", "jane@example.com"),
                User.of("bob_wilson", "bob@example.com")
            );
            
            // Process users
            List<CompletableFuture<User>> futures = users.stream()
                .map(user -> {
                    try {
                        return CompletableFuture.completedFuture(userService.createUser(
                            new CreateUserRequest(user.username(), user.email())
                        ));
                    } catch (ValidationException e) {
                        logger.error("Failed to create user: {}", user.username(), e);
                        return CompletableFuture.<User>failedFuture(e);
                    }
                })
                .collect(Collectors.toList());
            
            // Wait for all to complete
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                .thenRun(() -> {
                    logger.info("All users created successfully");
                    System.out.println("Application started successfully!");
                })
                .exceptionally(throwable -> {
                    logger.error("Failed to initialize users", throwable);
                    System.err.println("Application startup failed!");
                    return null;
                });
                
        } catch (Exception e) {
            logger.error("Application startup failed", e);
            System.exit(1);
        }
    }
}